@echo off
set "npm_config_cache=%~dp0.npm-cache"
npm exec --workspace @shopme/mcp-groceries -- shopme-mcp-groceries
