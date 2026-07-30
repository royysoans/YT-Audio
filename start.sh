#!/bin/bash
set -e

echo "Starting bgutil YouTube PO Token provider..."
bgutil-ytdlp-pot-provider &
BGUTIL_PID=$!

# Give the provider a moment to initialize
sleep 3

echo "bgutil provider started (PID $BGUTIL_PID)"
echo "Starting YT-Audio server..."

# Hand off to Node — this becomes PID 1 equivalent for signals
exec node server.js
