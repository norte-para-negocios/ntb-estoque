<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Mail\UserMailAfterCreate;
use App\Models\Loja;
use App\Models\User;
use App\Services\CanService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class UserController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

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
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        $user = new User();
        $action = 'create';
        return view('user.user', compact('action', 'user'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $pass = Str::random('20');
            $user = new User();
            $user->name = $request->get('name');
            $user->email = $request->get('email');
            $user->password = $pass;
            $user->save();

            // Lojas Vinculadas
            $user->lojas()->sync($request->get('lojas'));

            // Permissões
            if ($request->filled('permissao')) {
                foreach ($request->get('permissao') as $permissao) {
                    $split = explode('|', $permissao);
                    $user->permissoes()->attach($split[1], ['loja_id' => $split[0]]);
                }
            }

            Mail::to($user->email)->send(new UserMailAfterCreate($user, $pass));
            return redirect()->route('usuario.index')->with('success', 'Registro cadastrado com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('usuario.index')->with('error', $th->getMessage());
        }
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(User $user)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        $action = 'edit';
        return view('user.user', compact('action', 'user'));
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, User $user)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $update = [
                'name' => $request->get('name'),
                'email' => $request->get('email'),
            ];
            $user->update($update);
            $user->lojas()->sync($request->get('lojas'));
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
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            if ($user->id === Auth::user()->id) {
                abort(403, "Você não pode excluir a si mesmo!");
            }
            $user->lojas()->detach();
            $user->permissoes()->detach();
            $user->delete();
            return redirect()->route('usuario.index')->with('success', 'Registro excluído com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('usuario.index')->with('error', $th->getMessage());
        }
    }

    public function setCurrentLoja(User $user, Loja $loja)
    {
        try {
            $user->current_loja_id = $loja->id;
            $user->save();
            return response(['success', 'Registro atualizado com sucesso!']);
        } catch (\Throwable $th) {
            return response(['error', $th->getMessage()]);
        }
    }
}
