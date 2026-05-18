/**
 * Progressive Translation Manager
 * Handles non-blocking, prioritized translation of messages
 */

import { translationMiddleware, type TranslationResult } from './translationMiddleware';


export interface TranslationTask {
  id: string;
  content: string;
  priority: TranslationPriority;
  status: 'pending' | 'processing' | 'completed' | 'error';
  createdAt: number;
  completedAt?: number;
  result?: TranslationResult;
  retryCount: number;
}

export enum TranslationPriority {
  CRITICAL = 1,    // Currently visible messages
  HIGH = 2,        // Recent messages (last 10)
  NORMAL = 3,      // Other messages
  LOW = 4          // Background messages
}

export interface TranslationState {
  [messageId: string]: {
    status: 'original' | 'translating' | 'translated' | 'error';
    translatedContent?: string;
    originalContent: string;
    error?: string;
  };
}

export class ProgressiveTranslationManager {
  private queue: Map<string, TranslationTask> = new Map();
  private processing: Set<string> = new Set();
  private cache: Map<string, TranslationResult> = new Map();
  private subscribers: Map<string, (result: TranslationResult | null) => void> = new Map();
  private maxConcurrent = 3;
  private isProcessing = false;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor() {
    // Start processing queue
    this.processQueue();
  }

  /**
   * Add a translation task to the queue
   */
  addTask(
    messageId: string,
    content: string,
    priority: TranslationPriority = TranslationPriority.NORMAL,
    callback?: (result: TranslationResult | null) => void
  ): void {
    // Check cache first
    const cacheKey = this.getCacheKey(content);
    if (this.cache.has(cacheKey)) {
      const cachedResult = this.cache.get(cacheKey)!;
      callback?.(cachedResult);
      return;
    }

    // Add to queue
    const task: TranslationTask = {
      id: messageId,
      content: content.trim(),
      priority,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0
    };

    this.queue.set(messageId, task);

    if (callback) {
      this.subscribers.set(messageId, callback);
    }

    // 不再持久化排序：processQueue 取批前会重新排序，updatePriority 仅修改字段
  }

  /**
   * Remove a task from the queue (e.g., when component unmounts)
   */
  removeTask(messageId: string): void {
    // Cancel any ongoing request
    const controller = this.abortControllers.get(messageId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(messageId);
    }

    this.queue.delete(messageId);
    this.processing.delete(messageId);
    this.subscribers.delete(messageId);
  }

  /**
   * Update task priority (e.g., when message becomes visible)
   * 仅修改优先级字段；下一次取批时会自动按新优先级排序，无需立即重排
   */
  updatePriority(messageId: string, priority: TranslationPriority): void {
    const task = this.queue.get(messageId);
    if (task && task.status === 'pending') {
      task.priority = priority;
    }
  }

  /**
   * Get the current translation state for a message
   */
  getTranslationState(messageId: string): TranslationTask | undefined {
    return this.queue.get(messageId);
  }

  /**
   * Check if translation is enabled
   */
  async isTranslationEnabled(): Promise<boolean> {
    return await translationMiddleware.isEnabled();
  }

  /**
   * Process the translation queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (true) {
      // Get next batch of tasks to process
      const tasksToProcess = Array.from(this.queue.values())
        .filter(task => task.status === 'pending')
        .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
        .slice(0, this.maxConcurrent - this.processing.size);

      if (tasksToProcess.length === 0) {
        // No tasks to process, wait a bit
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Process tasks concurrently
      const promises = tasksToProcess.map(task => this.processTask(task));
      await Promise.allSettled(promises);

      // Short delay before next batch
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Process a single translation task
   */
  private async processTask(task: TranslationTask): Promise<void> {
    if (this.processing.has(task.id)) return;

    this.processing.add(task.id);
    task.status = 'processing';

    try {
      const controller = new AbortController();
      this.abortControllers.set(task.id, controller);
      // Check if translation is still needed
      if (!this.queue.has(task.id)) {
        return; // Task was removed
      }

      // Check cache again
      const cacheKey = this.getCacheKey(task.content);
      let result = this.cache.get(cacheKey);

      if (!result) {
        // Perform translation
        result = await translationMiddleware.translateClaudeResponse(task.content);

        // Cache the result
        if (result.wasTranslated) {
          this.cache.set(cacheKey, result);
          this.cleanupCache();
        }
      }

      // Update task
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;

      // Notify subscriber
      const callback = this.subscribers.get(task.id);
      if (callback) {
        callback(result);
        this.subscribers.delete(task.id);
      }

      

    } catch (error: any) {
      console.error(`[ProgressiveTranslation] Error processing task ${task.id}:`, error);

      // Handle retry logic
      if (task.retryCount < 3 && !error.name?.includes('Abort')) {
        task.retryCount++;
        task.status = 'pending';
        
      } else {
        task.status = 'error';
        const callback = this.subscribers.get(task.id);
        if (callback) {
          callback(null);
          this.subscribers.delete(task.id);
        }
      }
    } finally {
      this.processing.delete(task.id);
      this.abortControllers.delete(task.id);
    }
  }

  /**
   * Generate cache key for content
   */
  private getCacheKey(content: string): string {
    // Simple hash function for cache key
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `trans_${Math.abs(hash)}`;
  }

  /**
   * Clean up old cache entries (LRU-style cleanup)
   */
  private cleanupCache(): void {
    const MAX_CACHE_SIZE = 100;
    if (this.cache.size > MAX_CACHE_SIZE) {
      // Remove oldest 20 entries
      const entries = Array.from(this.cache.entries());
      const toRemove = entries.slice(0, 20);
      toRemove.forEach(([key]) => this.cache.delete(key));
    }
  }

  /**
   * Get queue statistics
   * 单次遍历累计各状态计数，避免 5 次 filter
   */
  getStats() {
    let total = 0;
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let errors = 0;

    for (const task of this.queue.values()) {
      total++;
      switch (task.status) {
        case 'pending':
          pending++;
          break;
        case 'processing':
          processing++;
          break;
        case 'completed':
          completed++;
          break;
        case 'error':
          errors++;
          break;
      }
    }

    return {
      total,
      pending,
      processing,
      completed,
      errors,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Cleanup all tasks and resources
   */
  cleanup(): void {
    // Cancel all ongoing requests
    this.abortControllers.forEach(controller => controller.abort());
    this.abortControllers.clear();

    // Clear all data
    this.queue.clear();
    this.processing.clear();
    this.subscribers.clear();
  }
}

// Export singleton instance
export const progressiveTranslationManager = new ProgressiveTranslationManager();
