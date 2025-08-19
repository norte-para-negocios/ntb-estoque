<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Loja;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class OmieWebhookController extends Controller
{
    public function webhook(Request $request)
    {
        try {
            if ($request->has('messageId') && $request->has('appKey') && ($loja = Loja::where('omie_app_key', $request->appKey)->first())) {
                dispatch(new \App\Jobs\OmieWebhookJob($loja, [
                    'messageId' => $request->get('messageId'),
                    'message' => $request->all()
                ]));
                return response()->json(['status' => 'success', 'message' => 'Webhook received'], 200);
            }
        } catch (\Throwable $th) {
            Log::error("Omie Webhook Failed: " . $th->getMessage());
        }
    }
}
