<?php

namespace App\Events;

use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class NotificaUserEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public User $user, public $type, public $message)
    {
    }

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('App.Models.User.' . $this->user->id)
        ];
    }

    public function broadcastAs()
    {
        return $this->type;
    }

    public function broadcastWith()
    {
        return ['message' => $this->message];
    }

}
