package com.example.booking;

public record SeatAvailability(
        String showId,
        String seatType,
        int remainingSeats,
        boolean available,
        boolean degraded) {

    public static SeatAvailability of(String showId, String seatType, int remainingSeats) {
        return new SeatAvailability(showId, seatType, remainingSeats, remainingSeats > 0, false);
    }

    public static SeatAvailability unknown() {
        return new SeatAvailability(null, null, 0, false, true);
    }
}
