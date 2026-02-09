<?php

namespace App\Services;

use App\Models\IntegrationAttempt;

trait IntegrationAttemptsTrait
{
    /**
     *  Logs the integration attempt before it completes.
     */
    private $integrationAttempt;

    private $loja_id;

    private $model;

    private $model_id;

    private $request;

    private $response;

    private $code;

    private $error;

    private function beforeAttemptLog()
    {
        $this->error = false;
        $integration_attempt = new IntegrationAttempt;
        $integration_attempt->loja_id = $this->loja_id;
        $integration_attempt->model = $this->model;
        $integration_attempt->error = $this->error;
        $integration_attempt->request = $this->request;
        $integration_attempt->save();
        $this->integrationAttempt = $integration_attempt;
    }

    private function afterAttemptLog()
    {
        $this->integrationAttempt->response = $this->response;
        $this->integrationAttempt->code = $this->code;
        $this->integrationAttempt->error = $this->error;
        $this->integrationAttempt->save();
    }
}
