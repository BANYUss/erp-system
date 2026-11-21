<?php

// Cegah Laravel memotong prefix "/api" dari REQUEST_URI
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';

require __DIR__ . '/../public/index.php';