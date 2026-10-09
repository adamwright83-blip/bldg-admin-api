import { defineConfig } from 'vite';
import application from './vite.config';

// Build the real application without reading local deployment credentials/config.
export default defineConfig({ ...application, envDir: false });
