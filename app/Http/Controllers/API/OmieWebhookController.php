<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Jobs\OmieWebhookJob;
use App\Models\Loja;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class OmieWebhookController extends Controller
{
    public function webhook(Request $request)
    {
        try {
            if ($request->has('messageId') && $request->has('appKey') && ($loja = Loja::where('omie_app_key', $request->appKey)->first())) {
                $message = $request->all();
                if (is_array($message)) {
                    if (
                        (stripos($message['topic'], 'Produto.AjusteEstoque') === false) &&
                        (stripos($message['topic'], 'Produto.MovimentacaoEstoque') === false)
                    ) {
                        dispatch(new OmieWebhookJob($loja, [
                            'messageId' => $request->get('messageId'),
                            'message' => $message
                        ]));
                    }
                }
                return response()->json(['status' => 'success', 'message' => 'Webhook received'], 200);
            }
        } catch (\Throwable $th) {
            Log::error("Omie Webhook Failed: " . $th->getMessage());
        }
    }
}
