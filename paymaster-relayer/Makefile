.PHONY: help install install-dev sync format lint lint-fix check fix test test-watch clean run run-local rofl-rebuild dev-setup pre-commit ci lint-markdown fix-markdown
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color
DOCKER_COMPOSE := docker compose

help: ## Show this help message
	@echo "$(BLUE)ROFL Relayer Development Commands$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

install: ## Install production dependencies
	@echo "$(BLUE)Installing production dependencies...$(NC)"
	uv sync --no-dev

install-dev: ## Install development dependencies
	@echo "$(BLUE)Installing development dependencies...$(NC)"
	uv sync --dev

sync: ## Sync all dependencies
	@echo "$(BLUE)Syncing all dependencies...$(NC)"
	uv sync

format: ## Format code with ruff
	@echo "$(BLUE)Formatting code...$(NC)"
	uv run ruff format .

lint: ## Lint code with ruff
	@echo "$(BLUE)Linting code...$(NC)"
	uv run ruff check .

lint-fix: ## Lint and fix code with ruff
	@echo "$(BLUE)Linting and fixing code...$(NC)"
	uv run ruff check --fix .

check: ## Check code formatting (dry run)
	@echo "$(BLUE)Checking code formatting...$(NC)"
	uv run ruff format --check .
	uv run ruff check .

fix: ## Auto-fix linting issues and format code
	@echo "$(BLUE)Fixing and formatting code...$(NC)"
	uv run ruff check --fix .
	uv run ruff format .

test: ## Run tests
	@echo "$(BLUE)Running tests...$(NC)"
	uv run pytest

test-watch: ## Run tests in watch mode
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	uv run pytest-watch

clean: ## Clean cache and temporary files
	@echo "$(BLUE)Cleaning up...$(NC)"
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	find . -type f -name "*.pyo" -delete 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	rm -rf build/ dist/ .coverage htmlcov/ .tox/ .mypy_cache/

run: ## Run the main application
	@echo "$(BLUE)Running application...$(NC)"
	uv run python -m paymaster_relayer

run-local: ## Start the relayer locally with Docker Compose
	@echo "$(BLUE)Starting local relayer stack...$(NC)"
	$(DOCKER_COMPOSE) -f compose.local.yaml up --build

rofl-rebuild: ## Build/push Docker image, build ROFL, and update deployment
	@echo "$(BLUE)Rebuilding ROFL deployment...$(NC)"
	@echo "$(YELLOW)Step 1:$(NC) Building and pushing Docker image..."
	$(DOCKER_COMPOSE) build --push
	@echo "$(YELLOW)Step 2:$(NC) Building ROFL application..."
	docker run --rm --platform linux/amd64 --volume $$(PWD):/src ghcr.io/oasisprotocol/rofl-dev:main oasis rofl build
	@echo "$(YELLOW)Step 3:$(NC) Updating ROFL deployment..."
	oasis rofl update
	@echo "$(GREEN)ROFL rebuild complete!$(NC)"

dev-setup: install-dev ## Set up development environment
	@echo "$(GREEN)Development environment setup complete!$(NC)"
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  - Run '$(GREEN)make check$(NC)' to lint and format code"
	@echo "  - Run '$(GREEN)make test$(NC)' to run tests"
	@echo "  - Run '$(GREEN)make run$(NC)' to start the application"

# Pre-commit hook simulation
pre-commit: format lint test ## Run pre-commit checks (format, lint, test)
	@echo "$(GREEN)Pre-commit checks passed!$(NC)"

# CI/CD simulation
ci: check test ## Run CI checks
	@echo "$(GREEN)CI checks completed!$(NC)"
