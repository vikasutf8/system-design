package com.example.booking;

import com.example.booking.cache.Cache;
import com.example.booking.database.Database;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

@Service
public class ProductionBookingService {

    private static final Logger log = LoggerFactory.getLogger(ProductionBookingService.class);

    private final ConcurrentHashMap<String, CompletableFuture<SeatAvailability>> inFlightRequests =
            new ConcurrentHashMap<>();

    private final Cache cache;
    private final Database database;
    private final ExecutorService executor;
    private final MeterRegistry metrics;

    public ProductionBookingService(Cache cache, Database database,
                                    ExecutorService executor, MeterRegistry metrics) {
        this.cache = cache;
        this.database = database;
        this.executor = executor;
        this.metrics = metrics;
        Gauge.builder("availability.inflight", inFlightRequests, map -> map.size())
                .register(metrics);
    }

    public CompletableFuture<SeatAvailability> checkAvailability(String showId, String seatType) {
        String cacheKey = buildCacheKey(showId, seatType);

        SeatAvailability cached = cache.get(cacheKey);
        if (cached != null) {
            metrics.counter("availability.cache.hit").increment();
            return CompletableFuture.completedFuture(cached);
        }

        metrics.counter("availability.cache.miss").increment();

        return inFlightRequests
                .computeIfAbsent(cacheKey, key -> createDatabaseFuture(showId, seatType, key))
                .orTimeout(5, TimeUnit.SECONDS)
                .exceptionally(ex -> handleFailure(ex, showId, seatType));
    }

    private CompletableFuture<SeatAvailability> createDatabaseFuture(
            String showId, String seatType, String cacheKey) {

        metrics.counter("availability.coalesced.leader").increment();

        return CompletableFuture.supplyAsync(() -> {
            try {
                SeatAvailability availability = database.checkSeatAvailability(showId, seatType);

                int jitteredTtl = 5 + ThreadLocalRandom.current().nextInt(3);
                cache.put(cacheKey, availability, jitteredTtl);

                return availability;
            } finally {
                inFlightRequests.remove(cacheKey);
            }
        }, executor);
    }

    private SeatAvailability handleFailure(Throwable ex, String showId, String seatType) {
        metrics.counter("availability.error").increment();
        log.error("Failed to check availability for {}/{}", showId, seatType, ex);
        return SeatAvailability.unknown();
    }

    private String buildCacheKey(String showId, String seatType) {
        return "availability:" + showId + ":" + seatType;
    }
}
