<?php

namespace App\Http\Controllers;

use App\Models\IntegrationAttempt;
use Carbon\Carbon;
use Illuminate\Http\Request;

class IntegrationAttemptController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function __invoke(Request $request)
    {
        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        $dateDiff = $data_final->diffInDays($data_inicio);

        if ($dateDiff > 1) {
            return redirect()->bakc()->with('warning', 'O período máximo para consulta é de 1 dia!');
        }


        $loja_id = $request->get('loja_id');
        $model = $request->get('model') ?? '';
        $request_field = $request->get('request_field') ?? '';
        $response_field = $request->get('response_field') ?? '';
        $code = $request->get('code') ?? '';
        $status = $request->get('status') ?? '';


        $logs = IntegrationAttempt::whereBetween('created_at', [$data_inicio->format('Y-m-d H:i:s'), $data_final->format('Y-m-d H:i:s')])
            ->where('loja_id', $loja_id)
            ->where('model', $model)
            ->when($request_field, function ($query, $request_field) {
                $query->where('request', 'like', '%' . $request_field . '%');
            })
            ->when($response_field, function ($query, $response_field) {
                $query->where('response', 'like', '%' . $response_field . '%');
            })
            ->when($code, function ($query, $code) {
                $query->where('code', '=', $code);
            })
            ->when($status, function ($query, $status) {
                $query->where('erro', '=', (boolean)$status);
            })
            ->orderBy('created_at', 'desc')
            ->paginate(10)
            ->withQueryString();

        return view('log.index', compact('logs', 'loja_id', 'model', 'request_field', 'response_field', 'code', 'status', 'data_inicio', 'data_final'));
    }
}
