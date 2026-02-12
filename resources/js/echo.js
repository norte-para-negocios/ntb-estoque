import Echo from 'laravel-echo';

import Pusher from 'pusher-js';
window.Pusher = Pusher;

const reverbConfig = window.reverbConfig ?? {};
const config = {
     key: reverbConfig.key ?? import.meta.env.VITE_REVERB_APP_KEY,
     wsHost: reverbConfig.host ?? import.meta.env.VITE_REVERB_HOST,
     wsPort: reverbConfig.port ?? import.meta.env.VITE_REVERB_PORT ?? 80,
     wssPort: reverbConfig.port ?? import.meta.env.VITE_REVERB_PORT ?? 443,
     scheme: reverbConfig.scheme ?? import.meta.env.VITE_REVERB_SCHEME ?? 'https',
 };

window.Echo = new Echo({
    broadcaster: 'reverb',
    key: config.key,
    wsHost: config.wsHost,
    wsPort: config.wsPort,
    wssPort: config.wssPort,
    forceTLS: config.scheme === 'https',
    enabledTransports: ['ws', 'wss'],
});
