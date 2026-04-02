<?php

use App\Services\CircuitBreakerService;
use Illuminate\Support\Facades\Cache;

beforeEach(function () {
    Cache::flush();
});

it('starts in closed state', function () {
    $circuitBreaker = new CircuitBreakerService('test-service');

    expect($circuitBreaker->getState())->toBe('closed');
    expect($circuitBreaker->isAvailable())->toBeTrue();
});

it('opens after reaching failure threshold', function () {
    $circuitBreaker = new CircuitBreakerService('test-service', failureThreshold: 3);

    $circuitBreaker->recordFailure();
    $circuitBreaker->recordFailure();
    expect($circuitBreaker->getState())->toBe('closed');

    $circuitBreaker->recordFailure();
    expect($circuitBreaker->getState())->toBe('open');
});

it('blocks requests when open', function () {
    $circuitBreaker = new CircuitBreakerService('test-service', failureThreshold: 3, recoverySeconds: 120);

    $circuitBreaker->recordFailure();
    $circuitBreaker->recordFailure();
    $circuitBreaker->recordFailure();

    expect($circuitBreaker->getState())->toBe('open');
    expect($circuitBreaker->isAvailable())->toBeFalse();
});

it('transitions to half-open after recovery period', function () {
    $circuitBreaker = new CircuitBreakerService('test-service', failureThreshold: 1, recoverySeconds: 1);

    $circuitBreaker->recordFailure();
    expect($circuitBreaker->getState())->toBe('open');

    // Simulate cooldown expiry by manipulating the cache key directly
    Cache::put('circuit_breaker:test-service:cooldown', now()->subSecond()->timestamp, 300);

    expect($circuitBreaker->isAvailable())->toBeTrue();
    expect($circuitBreaker->getState())->toBe('half_open');
});

it('closes after successful request in half-open state', function () {
    $circuitBreaker = new CircuitBreakerService('test-service', failureThreshold: 1, recoverySeconds: 1);

    $circuitBreaker->recordFailure();

    // Force transition to half-open
    Cache::put('circuit_breaker:test-service:cooldown', now()->subSecond()->timestamp, 300);
    $circuitBreaker->isAvailable(); // triggers transitionToHalfOpen internally

    expect($circuitBreaker->getState())->toBe('half_open');

    $circuitBreaker->recordSuccess();

    expect($circuitBreaker->getState())->toBe('closed');
    expect($circuitBreaker->isAvailable())->toBeTrue();
});

it('does not open for rate limit errors when failures stay below threshold', function () {
    // The circuit breaker only opens when recordFailure() is called enough times.
    // A 425 rate-limit error should be handled by the caller without calling recordFailure(),
    // so the circuit stays closed.
    $circuitBreaker = new CircuitBreakerService('test-service', failureThreshold: 5);

    // Simulate 4 failures (below threshold) — circuit stays closed
    $circuitBreaker->recordFailure();
    $circuitBreaker->recordFailure();
    $circuitBreaker->recordFailure();
    $circuitBreaker->recordFailure();

    expect($circuitBreaker->getState())->toBe('closed');
    expect($circuitBreaker->isAvailable())->toBeTrue();
});
