<x-mail::message>
Olá {{ $user->name }},

Sua conta foi criada com sucesso!<br><br>

Sugerimos que troque sua senha assim que possível, segue link de redefinição de senha abaixo.<br>

<x-mail::button :url="route('password.request')">
    Trocar senha
</x-mail::button>

Bem vindo(a),<br>
{{ config('app.name') }}
</x-mail::message>
