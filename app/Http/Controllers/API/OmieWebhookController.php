<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Jobs\OmieWebhookJob;
use App\Models\Loja;
use App\Models\Webhook;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class OmieWebhookController extends Controller
{
    public function webhook(Request $request)
    {
        try {
            if ($request->has('messageId') && $request->has('appKey') && ($loja = Loja::where('omie_app_key', $request->appKey)->first())) {
                if (Webhook::where('loja_id', $loja->id)->where('message_id', $request->messageId)->exists()) {
                    return response()->json(['status' => 'success', 'message' => 'Webhook already processed'], 200);
                }

                $message = $request->all();
                if (is_array($message)) {
                    if (
                        (stripos($message['topic'], 'Produto.AjusteEstoque') === false) &&
                        (stripos($message['topic'], 'Produto.MovimentacaoEstoque') === false)
                    ) {
                        dispatch(new OmieWebhookJob($loja, [
                            'messageId' => $request->get('messageId'),
                            'message' => $message,
                        ]));
                    }
                }

                return response()->json(['status' => 'success', 'message' => 'Webhook received'], 200);
            }
        } catch (\Throwable $th) {
            Log::error('Omie Webhook Failed: '.$th->getMessage());
        }
    }
}
