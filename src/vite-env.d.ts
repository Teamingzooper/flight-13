/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** TURN relay URLs, comma separated (e.g. "turn:relay.example.com:80,turns:relay.example.com:443?transport=tcp"). */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}
