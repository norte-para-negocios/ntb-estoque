<?php

namespace App\Http\Controllers;

use App\Models\IntegrationAttempt;
use Illuminate\Http\Request;

class IntegrationAttemptController extends Controller
{
    public function __invoke(Request $request)
    {
        $logs = IntegrationAttempt::when($request->search, function ($query, $search) {
            $query->where('request', 'like', '%' . $search . '%')
                ->orWhere('response', 'like', '%' . $search . '%')
                ->orWhere('code', 'like', '%' . $search . '%')
                ->orWhere('error_message', 'like', '%' . $search . '%');
        })
            ->orderBy('created_at', 'desc')
            ->paginate(10)
            ->withQueryString();
        return view('log.index', compact('logs'));
    }
}
