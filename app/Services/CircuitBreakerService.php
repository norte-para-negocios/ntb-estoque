<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CircuitBreakerService
{
    private const STATE_CLOSED = 'closed';

    private const STATE_OPEN = 'open';

    private const STATE_HALF_OPEN = 'half_open';

    public function __construct(
        private readonly string $key,
        private readonly int $failureThreshold = 5,
        private readonly int $recoverySeconds = 120,
    ) {}

    public function isAvailable(): bool
    {
        $state = $this->getState();

        if ($state === self::STATE_CLOSED) {
            return true;
        }

        if ($state === self::STATE_OPEN) {
            // Verifica se já passou o período de resfriamento
            if ($this->getCooldownExpiry() <= now()->timestamp) {
                $this->transitionToHalfOpen();

                return true;
            }

            return false;
        }

        // Half-open: permite uma tentativa
        return true;
    }

    public function recordSuccess(): void
    {
        if ($this->getState() !== self::STATE_CLOSED) {
            $this->transitionToClosed();
        }
    }

    public function recordFailure(): void
    {
        $failures = Cache::increment($this->failureKey());

        if ($failures >= $this->failureThreshold) {
            $this->transitionToOpen();
        }
    }

    public function getState(): string
    {
        return Cache::get($this->stateKey(), self::STATE_CLOSED);
    }

    private function transitionToOpen(): void
    {
        Cache::put($this->stateKey(), self::STATE_OPEN, now()->addSeconds($this->recoverySeconds * 2));
        Cache::put($this->cooldownKey(), now()->addSeconds($this->recoverySeconds)->timestamp, $this->recoverySeconds * 2);
        Cache::forget($this->failureKey());
    }

    private function transitionToHalfOpen(): void
    {
        Cache::put($this->stateKey(), self::STATE_HALF_OPEN, now()->addSeconds($this->recoverySeconds));
    }

    private function transitionToClosed(): void
    {
        Cache::put($this->stateKey(), self::STATE_CLOSED, now()->addDay());
        Cache::forget($this->failureKey());
        Cache::forget($this->cooldownKey());
    }

    private function getCooldownExpiry(): int
    {
        return (int) Cache::get($this->cooldownKey(), 0);
    }

    private function stateKey(): string
    {
        return "circuit_breaker:{$this->key}:state";
    }

    private function failureKey(): string
    {
        return "circuit_breaker:{$this->key}:failures";
    }

    private function cooldownKey(): string
    {
        return "circuit_breaker:{$this->key}:cooldown";
    }
}
