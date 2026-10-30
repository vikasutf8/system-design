package com.example.booking;

import com.example.booking.cache.InMemoryTtlCache;
import com.example.booking.database.Database;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProductionBookingServiceTest {

    private Database database;
    private ExecutorService executor;
    private SimpleMeterRegistry metrics;
    private ProductionBookingService service;

    @BeforeEach
    void setUp() {
        database = mock(Database.class);
        executor = Executors.newFixedThreadPool(4);
        metrics = new SimpleMeterRegistry();
        service = new ProductionBookingService(new InMemoryTtlCache(), database, executor, metrics);
    }

    @AfterEach
    void tearDown() {
        executor.shutdownNow();
        metrics.close();
    }

    @Test
    void coalescesConcurrentRequestsIntoOneDatabaseCall() throws Exception {
        CountDownLatch databaseStarted = new CountDownLatch(1);
        CountDownLatch releaseDatabase = new CountDownLatch(1);

        when(database.checkSeatAvailability("show-1", "PREMIUM")).thenAnswer(invocation -> {
            databaseStarted.countDown();
            releaseDatabase.await(5, TimeUnit.SECONDS);
            return SeatAvailability.of("show-1", "PREMIUM", 42);
        });

        CompletableFuture<SeatAvailability> first = service.checkAvailability("show-1", "PREMIUM");
        assertTrue(databaseStarted.await(5, TimeUnit.SECONDS));

        CompletableFuture<SeatAvailability> second = service.checkAvailability("show-1", "PREMIUM");
        CompletableFuture<SeatAvailability> third = service.checkAvailability("show-1", "PREMIUM");

        releaseDatabase.countDown();

        assertEquals(42, first.get(5, TimeUnit.SECONDS).remainingSeats());
        assertEquals(42, second.get(5, TimeUnit.SECONDS).remainingSeats());
        assertEquals(42, third.get(5, TimeUnit.SECONDS).remainingSeats());

        verify(database, times(1)).checkSeatAvailability("show-1", "PREMIUM");
    }

    @Test
    void servesSubsequentCallsFromCache() throws Exception {
        when(database.checkSeatAvailability("show-2", "STANDARD"))
                .thenReturn(SeatAvailability.of("show-2", "STANDARD", 10));

        SeatAvailability first = service.checkAvailability("show-2", "STANDARD").get(5, TimeUnit.SECONDS);
        SeatAvailability second = service.checkAvailability("show-2", "STANDARD").get(5, TimeUnit.SECONDS);

        assertEquals(10, first.remainingSeats());
        assertEquals(10, second.remainingSeats());
        verify(database, times(1)).checkSeatAvailability("show-2", "STANDARD");
    }

    @Test
    void degradesGracefullyWhenDatabaseFails() throws Exception {
        when(database.checkSeatAvailability("fail", "PREMIUM"))
                .thenThrow(new IllegalStateException("database down"));

        SeatAvailability result = service.checkAvailability("fail", "PREMIUM").get(5, TimeUnit.SECONDS);

        assertTrue(result.degraded());
        assertFalse(result.available());
        assertEquals(0, result.remainingSeats());
    }
}
