# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM rust:1.80-slim AS backend-build
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock* ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY backend/src/ ./src/
RUN touch src/main.rs && cargo build --release

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-build /app/backend/target/release/swords-of-the-slain ./server
COPY --from=frontend-build /app/frontend/dist ./static
ENV STATIC_DIR=/app/static
ENV PORT=3000
EXPOSE 3000
CMD ["./server"]
