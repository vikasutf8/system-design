package com.example.booking.cache;

import com.example.booking.SeatAvailability;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
public class InMemoryTtlCache implements Cache {

    private record Entry(SeatAvailability value, long expiresAtNanos) {
    }

    private final ConcurrentHashMap<String, Entry> store = new ConcurrentHashMap<>();

    @Override
    public SeatAvailability get(String key) {
        Entry entry = store.get(key);
        if (entry == null) {
            return null;
        }
        if (System.nanoTime() >= entry.expiresAtNanos()) {
            store.remove(key, entry);
            return null;
        }
        return entry.value();
    }

    @Override
    public void put(String key, SeatAvailability value, int ttlSeconds) {
        long expiresAt = System.nanoTime() + TimeUnit.SECONDS.toNanos(ttlSeconds);
        store.put(key, new Entry(value, expiresAt));
    }
}
