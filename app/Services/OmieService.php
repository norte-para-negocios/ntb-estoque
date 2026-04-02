<?php

namespace App\Services;

use App\Models\Loja;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class OmieService
{
    use IntegrationAttemptsTrait;

    private string $urlBase = 'https://app.omie.com.br/api/';

    // Métodos que têm restrição especial de 1 requisição por vez
    private array $singleRequestMethods = [
        'ExcluirAjusteEstoque',
        'IncluirAjusteEstoque',
    ];

    // Limites de rate limit
    private const RATE_LIMIT_IP_PER_MINUTE = 960;

    private const RATE_LIMIT_IP_APPKEY_METHOD_PER_MINUTE = 240;

    private const RATE_LIMIT_CONCURRENT_REQUESTS = 4;

    private const RATE_LIMIT_SINGLE_REQUEST = 1;

    public function __construct(protected Loja $loja) {}

    public function excluirAjusteEstoque(int $idAjuste): bool
    {
        $url = $this->urlBase.'v1/estoque/ajuste/';
        $method = 'ExcluirAjusteEstoque';
        $data = [
            'call' => $method,
            'app_key' => $this->loja->omie_app_key,
            'app_secret' => $this->loja->omie_app_secret,
            'param' => [
                [
                    'id_ajuste' => $idAjuste,
                ],
            ],
        ];

        return $this->makeRequest($url, $method, $data, [
            'id_ajuste' => $idAjuste,
        ]);
    }

    private function makeRequest(string $url, string $method, array $data, array $context = []): bool
    {
        $ip = request()->ip() ?? '0.0.0.0';
        $appKey = $this->loja->omie_app_key;
        $isSingleRequestMethod = in_array($method, $this->singleRequestMethods, true);

        $circuitBreaker = new CircuitBreakerService("omie:{$appKey}:{$method}");

        if (! $circuitBreaker->isAvailable()) {
            Log::warning('Circuit breaker open for OMIE API', [
                'loja_id' => $this->loja->id,
                'call' => $method,
            ]);

            return false;
        }

        // Aguardar rate limits antes de fazer a requisição
        $this->waitForRateLimit($ip, $appKey, $method, $isSingleRequestMethod);

        // Obter lock para requisições simultâneas
        $concurrentKey = "omie:concurrent:{$ip}:{$appKey}:{$method}";
        $lockKey = "omie:lock:{$ip}:{$appKey}:{$method}";

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'AjusteEstoque';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        $result = false;

        try {
            $lock = Cache::lock($lockKey, 60);

            try {
                // Tentar adquirir lock, aguardando até 30 segundos
                $lock->block(30, function () use ($url, $data, $method, $context, $ip, $appKey, $concurrentKey, $circuitBreaker, &$result) {
                    // Verificar se ainda está dentro dos limites antes de fazer a requisição
                    $this->checkRateLimits($ip, $appKey, $method);

                    // Incrementar contadores antes da requisição
                    $this->incrementRateLimitCounters($ip, $appKey, $method, $concurrentKey);

                    try {
                        $response = Http::withHeaders([
                            'Content-Type' => 'application/json',
                        ])->connectTimeout(60)->timeout(60)->post($url, $data);

                        // Log de integração
                        $this->response = $response->getBody()->getContents();
                        $this->code = $response->getStatusCode();

                        if ($response->status() === 200) {
                            $circuitBreaker->recordSuccess();
                            $result = true;

                            return;
                        }

                        // Tratar erro 425 (Rate Limit)
                        if ($response->status() === 425) {
                            $responseData = $response->object();
                            preg_match('/em (\d+) segundos/', $responseData->faultstring ?? '', $matches);
                            if (isset($matches[1])) {
                                $waitSeconds = (int) $matches[1];
                                Log::warning('Rate limit atingido na API Omie, aguardando', [
                                    'loja_id' => $this->loja->id,
                                    'method' => $method,
                                    'wait_seconds' => $waitSeconds,
                                    'context' => $context,
                                ]);
                                sleep($waitSeconds);
                            }
                        }

                        if ($response->status() !== 425) {
                            $circuitBreaker->recordFailure();
                        }

                        Log::warning('Falha na requisição à API Omie', [
                            'loja_id' => $this->loja->id,
                            'method' => $method,
                            'status' => $response->status(),
                            'response' => $this->response,
                            'context' => $context,
                        ]);

                        $result = false;
                    } catch (Throwable $th) {
                        // Log de erro
                        $this->integrationAttempt->error_message = json_encode($th->getMessage());
                        $this->code = $th->getCode();
                        $this->error = true;

                        $circuitBreaker->recordFailure();

                        Log::error('Erro na requisição à API Omie', [
                            'loja_id' => $this->loja->id,
                            'method' => $method,
                            'erro' => $th->getMessage(),
                            'context' => $context,
                        ]);

                        $result = false;
                    } finally {
                        // Decrementar contador de requisições simultâneas
                        $this->decrementConcurrentCounter($concurrentKey);
                    }
                });
            } catch (LockTimeoutException $e) {
                Log::warning('Timeout ao adquirir lock para requisição à API Omie', [
                    'loja_id' => $this->loja->id,
                    'method' => $method,
                    'lock_key' => $lockKey,
                    'context' => $context,
                ]);

                $result = false;
            } finally {
                if ($lock->owned()) {
                    $lock->release();
                }
            }
        } finally {
            $this->afterAttemptLog();
        }

        return $result;
    }

    private function waitForRateLimit(string $ip, string $appKey, string $method, bool $isSingleRequestMethod): void
    {
        $maxWaitTime = 60; // máximo de 60 segundos de espera
        $startTime = time();

        while (time() - $startTime < $maxWaitTime) {
            if ($this->canMakeRequest($ip, $appKey, $method, $isSingleRequestMethod)) {
                return;
            }

            // Aguardar um pouco antes de verificar novamente
            usleep(100000); // 100ms
        }

        Log::warning('Timeout ao aguardar rate limit da API Omie', [
            'loja_id' => $this->loja->id,
            'ip' => $ip,
            'method' => $method,
        ]);
    }

    private function canMakeRequest(string $ip, string $appKey, string $method, bool $isSingleRequestMethod): bool
    {
        // Verificar limite por IP (960/min)
        $ipKey = "omie:rate:ip:{$ip}";
        $ipCount = Cache::get($ipKey, 0);
        if ($ipCount >= self::RATE_LIMIT_IP_PER_MINUTE) {
            return false;
        }

        // Verificar limite por IP + App Key + Método (240/min)
        $methodKey = "omie:rate:method:{$ip}:{$appKey}:{$method}";
        $methodCount = Cache::get($methodKey, 0);
        if ($methodCount >= self::RATE_LIMIT_IP_APPKEY_METHOD_PER_MINUTE) {
            return false;
        }

        // Verificar requisições simultâneas
        $lockKey = "omie:lock:{$ip}:{$appKey}:{$method}";
        $maxConcurrent = $isSingleRequestMethod ? self::RATE_LIMIT_SINGLE_REQUEST : self::RATE_LIMIT_CONCURRENT_REQUESTS;
        $concurrentKey = "omie:concurrent:{$ip}:{$appKey}:{$method}";
        $concurrentCount = Cache::get($concurrentKey, 0);
        if ($concurrentCount >= $maxConcurrent) {
            return false;
        }

        return true;
    }

    private function checkRateLimits(string $ip, string $appKey, string $method): void
    {
        if (! $this->canMakeRequest($ip, $appKey, $method, in_array($method, $this->singleRequestMethods, true))) {
            throw new \RuntimeException('Rate limit excedido para requisição à API Omie');
        }
    }

    private function incrementRateLimitCounters(string $ip, string $appKey, string $method, string $concurrentKey): void
    {
        // Incrementar contador por IP
        $ipKey = "omie:rate:ip:{$ip}";
        $ipCount = Cache::increment($ipKey);
        if ($ipCount === 1) {
            Cache::put($ipKey, $ipCount, now()->addMinute());
        }

        // Incrementar contador por IP + App Key + Método
        $methodKey = "omie:rate:method:{$ip}:{$appKey}:{$method}";
        $methodCount = Cache::increment($methodKey);
        if ($methodCount === 1) {
            Cache::put($methodKey, $methodCount, now()->addMinute());
        }

        // Incrementar contador de requisições simultâneas
        $isSingleRequestMethod = in_array($method, $this->singleRequestMethods, true);
        $maxConcurrent = $isSingleRequestMethod ? self::RATE_LIMIT_SINGLE_REQUEST : self::RATE_LIMIT_CONCURRENT_REQUESTS;

        $currentConcurrent = Cache::get($concurrentKey, 0);
        if ($currentConcurrent < $maxConcurrent) {
            Cache::increment($concurrentKey);
        }
    }

    private function decrementConcurrentCounter(string $concurrentKey): void
    {
        $current = Cache::get($concurrentKey, 0);
        if ($current > 0) {
            Cache::decrement($concurrentKey);
        }
    }
}
