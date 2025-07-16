<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Loja;
use App\Models\Webhook;
use Illuminate\Http\Request;

class OrdemProducaoWebhookController extends Controller
{
    public function webhook(Request $request)
    {
        try {
            if ($request->has('appKey') && ($loja = Loja::where('omie_app_key', $request->appKey)->first())) {
                dispatch(new \App\Jobs\OrdemProducaoWebhookJob($loja, [
                    'messageId' => $request->get('messageId'),
                    'message' => $request->all()
                ]));
                return response()->json(['status' => 'success', 'message' => 'Webhook received'], 200);
            }
        } finally {
            return response()->json();
        }
    }
}
