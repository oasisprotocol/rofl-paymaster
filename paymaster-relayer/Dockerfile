# Use official uv image with Python 3.12
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install Python dependencies
RUN uv sync --frozen

# Copy source code
COPY paymaster_relayer/ ./paymaster_relayer/
COPY abis/ ./abis/

# Run the relayer using module execution
ENTRYPOINT ["uv", "run", "python", "-m", "paymaster_relayer"]
