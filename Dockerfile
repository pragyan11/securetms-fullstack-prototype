# Use official Node.js LTS image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install app dependencies (including production only)
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose the port (default 4000, can be overridden via PORT env)
EXPOSE 4000

# Set environment variables for production
ENV NODE_ENV=production

# Start the server
CMD ["node", "server.js"]
