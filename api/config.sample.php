<?php
// Copy to finance-private/config.php OUTSIDE public_html. Never commit the real file.
// Generate keys with:  php -r 'echo base64_encode(random_bytes(32)), PHP_EOL;'
return [
    'db' => ['host' => 'localhost', 'port' => 3306, 'name' => 'uXXXX_finance', 'user' => 'uXXXX_finance', 'pass' => 'CHANGE_ME'],
    'encryption_key' => 'BASE64_32_BYTES',   // encrypts descriptions/notes. Losing it makes them unreadable: back it up separately.
    'pepper' => 'RANDOM_LONG_STRING',         // hashes IPs/e-mails for login throttling
    'app_origin' => 'https://finance.elev8solucoes.com.br',
    'cookie_secure' => true,
];
