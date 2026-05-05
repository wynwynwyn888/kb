-- AlterEnum: guard outcome when conversation automation is paused
ALTER TYPE "OrchestrationOutcome" ADD VALUE IF NOT EXISTS 'SKIP_AUTOMATION_PAUSED';
