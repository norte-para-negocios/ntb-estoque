<?php

namespace App\Http\Controllers;

use App\Mail\UserMailAfterCreate;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class UserController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = User::orderBy('name');
        if ($request->filled('search')) {
            $query->where('name', 'like', "%{$request->get('search')}%")
                ->orWhere('email', 'like', "%{$request->get('search')}%");
        }
        $usuarios = $query->get();
        return view('user.index', compact('usuarios'));
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        $user = new User();
        $action = 'create';
        return view('user.user', compact('action', 'user'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        try {
            $pass = Str::random('20');
            $user = new User();
            $user->name = $request->get('name');
            $user->email = $request->get('email');
            $user->password = $pass;
            $user->save();
            Mail::to($user->email)->send(new UserMailAfterCreate($user, $pass));
            return redirect()->route('usuario.index')->with('success', 'Registro cadastrado com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('usuario.index')->with('error', $th->getMessage());
        }
    }

    /**
     * Display the specified resource.
     */
    public function show(User $user)
    {
        //
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(User $user)
    {
        $action = 'edit';
        return view('user.user', compact('action', 'user'));
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, User $user)
    {
        try {
            $update = [
                'name' => $request->get('name'),
                'email' => $request->get('email'),
            ];
            $user->update($update);
            return redirect()->route('usuario.index')->with('success', 'Registro atualizado com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('usuario.index')->with('error', $th->getMessage());
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(User $user)
    {
        try {
            $user->delete();
            return redirect()->route('usuario.index')->with('success', 'Registro excluído com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('usuario.index')->with('error', $th->getMessage());
        }
    }
}
