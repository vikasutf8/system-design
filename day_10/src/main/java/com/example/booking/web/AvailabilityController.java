package com.example.booking.web;

import com.example.booking.ProductionBookingService;
import com.example.booking.SeatAvailability;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.stream.IntStream;

@RestController
@RequestMapping("/api")
public class AvailabilityController {

    private final ProductionBookingService bookingService;

    public AvailabilityController(ProductionBookingService bookingService) {
        this.bookingService = bookingService;
    }

    @GetMapping("/availability")
    public CompletableFuture<SeatAvailability> availability(
            @RequestParam String showId,
            @RequestParam(defaultValue = "PREMIUM") String seatType) {
        return bookingService.checkAvailability(showId, seatType);
    }

    @GetMapping("/availability/burst")
    public List<SeatAvailability> burst(
            @RequestParam String showId,
            @RequestParam(defaultValue = "PREMIUM") String seatType,
            @RequestParam(defaultValue = "20") int count) {

        List<CompletableFuture<SeatAvailability>> requests = IntStream.range(0, Math.max(1, count))
                .mapToObj(ignored -> bookingService.checkAvailability(showId, seatType))
                .toList();

        CompletableFuture.allOf(requests.toArray(CompletableFuture[]::new)).join();

        return requests.stream()
                .map(CompletableFuture::join)
                .toList();
    }
}
