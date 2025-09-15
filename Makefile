## ROFL Paymaster - Root Makefile

.PHONY: help lint-markdown fix-markdown
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)ROFL Paymaster - Repository Tasks$(NC)"
	@echo ""
	@echo "$(YELLOW)Top-level targets:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-22s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Component workflows:$(NC)"
	@echo "  - Contracts: see contracts/README.md"
	@echo "  - Relayer: see paymaster-relayer/README.md"

lint-markdown: ## Lint Markdown files using markdownlint (Docker)
	@echo "$(BLUE)Linting Markdown files with markdownlint...$(NC)"
	docker run --rm -v "$$PWD:/work" -w /work ghcr.io/igorshubovych/markdownlint-cli:latest \
	  markdownlint -c .markdownlint.yml --ignore-path .markdownlintignore .

fix-markdown: ## Auto-fix Markdown issues using markdownlint (Docker)
	@echo "$(BLUE)Fixing Markdown files with markdownlint --fix...$(NC)"
	docker run --rm -v "$$PWD:/work" -w /work ghcr.io/igorshubovych/markdownlint-cli:latest \
	  markdownlint -c .markdownlint.yml --ignore-path .markdownlintignore --fix .
