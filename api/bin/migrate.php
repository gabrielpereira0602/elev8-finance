<?php
declare(strict_types=1);
// Usage: php bin/migrate.php  (reads FINANCE_CONFIG or ../finance-private/config.php)
require dirname(__DIR__) . '/vendor/autoload.php';
$config = require (getenv('FINANCE_CONFIG') ?: dirname(__DIR__, 2) . '/finance-private/config.php');
$db = Elev8\Finance\Db::connect($config['db']);
$db->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(32) PRIMARY KEY, applied_at DATETIME NOT NULL)');
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) {
    $v = basename($file, '.sql');
    if ($db->one('SELECT version FROM schema_migrations WHERE version = ?', [$v])) {
        continue;
    }
    foreach (array_filter(array_map('trim', explode(";\n", (string) file_get_contents($file)))) as $sql) {
        if (preg_replace('/^(--[^\n]*\n)+/', '', $sql . "\n") !== '') {
            $db->pdo->exec($sql);
        }
    }
    $db->run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, NOW())', [$v]);
    echo "applied $v\n";
}
echo "ok\n";
