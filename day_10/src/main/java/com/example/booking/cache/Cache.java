package com.example.booking.cache;

import com.example.booking.SeatAvailability;

public interface Cache {

    SeatAvailability get(String key);

    void put(String key, SeatAvailability value, int ttlSeconds);
}
