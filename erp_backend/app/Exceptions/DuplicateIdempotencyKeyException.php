<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class DuplicateIdempotencyKeyException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $idempotencyKey,
        public readonly ?string $resourceType = null,
        public readonly ?int $existingResourceId = null
    ) {
        parent::__construct($message, 409);
    }

    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'error' => 'duplicate_idempotency_key',
            'idempotency_key' => $this->idempotencyKey,
            'resource_type' => $this->resourceType,
            'existing_resource_id' => $this->existingResourceId,
        ], 409);
    }
}
