<?php
declare(strict_types=1);
// Invite-only beta: accounts are created here, never through a public sign-up page.
// Usage: php bin/create-user.php email@exemplo.com "Nome"   (password is asked interactively, never in shell history)
require dirname(__DIR__) . '/vendor/autoload.php';
$config = require (getenv('FINANCE_CONFIG') ?: dirname(__DIR__, 2) . '/finance-private/config.php');
[$_, $email, $name] = $argv + [null, null, null];
if (!$email) {
    fwrite(STDERR, "Uso: php bin/create-user.php email [nome]\n");
    exit(1);
}
fwrite(STDOUT, 'Senha (mín. 10 caracteres): ');
system('stty -echo 2>/dev/null');
$password = trim((string) fgets(STDIN));
system('stty echo 2>/dev/null');
fwrite(STDOUT, "\n");
$db = Elev8\Finance\Db::connect($config['db']);
$app = new Elev8\Finance\App($db, $config);
$id = $app->users->create($email, $password, $name);
echo "Usuário criado: $id\n";
