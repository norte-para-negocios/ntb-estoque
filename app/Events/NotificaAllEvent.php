<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class NotificaAllEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public $type, public $message)
    {
    }

    public function broadcastOn(): array
    {
        return [
            new Channel('All.User')
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
