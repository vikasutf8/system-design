package com.example.booking.database;

import com.example.booking.SeatAvailability;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class Database {

    private static final int INITIAL_SEATS = 100;

    private final ConcurrentHashMap<String, AtomicInteger> seatsByShowAndType = new ConcurrentHashMap<>();

    public SeatAvailability checkSeatAvailability(String showId, String seatType) {
        if ("fail".equalsIgnoreCase(showId)) {
            throw new IllegalStateException("Simulated database failure for show " + showId);
        }

        simulateDatabaseLatency();

        String key = showId + ":" + seatType;
        int remaining = seatsByShowAndType
                .computeIfAbsent(key, ignored -> new AtomicInteger(INITIAL_SEATS))
                .get();

        return SeatAvailability.of(showId, seatType, remaining);
    }

    private void simulateDatabaseLatency() {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextLong(200, 450));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Database call interrupted", ex);
        }
    }
}
