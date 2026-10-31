-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT,
    "accessScopes" TEXT,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "title" TEXT,
    "selectedProductIds" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "confirmedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "GenerationJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "handle" TEXT,
    "title" TEXT,
    "descriptionHtml" TEXT,
    "imagesJson" TEXT NOT NULL DEFAULT '[]',
    "metafieldsJson" TEXT NOT NULL DEFAULT '[]',
    "sizeChartJson" TEXT NOT NULL DEFAULT '{}',
    "manualEditsJson" TEXT NOT NULL DEFAULT '{}',
    "missingFlagsJson" TEXT NOT NULL DEFAULT '[]',
    "reviewNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EngineRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT 'runpod',
    "endpointId" TEXT,
    "externalRunId" TEXT,
    "requestJson" TEXT NOT NULL DEFAULT '{}',
    "responseJson" TEXT NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "photoOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "EngineRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset3D" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productSnapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'base',
    "sizeLabel" TEXT,
    "storageUrl" TEXT,
    "mimeType" TEXT,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "engineRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset3D_productSnapshotId_fkey" FOREIGN KEY ("productSnapshotId") REFERENCES "ProductSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset3D_engineRunId_fkey" FOREIGN KEY ("engineRunId") REFERENCES "EngineRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "ProductSnapshot_jobId_idx" ON "ProductSnapshot"("jobId");

-- CreateIndex
CREATE INDEX "ProductSnapshot_shopifyProductId_idx" ON "ProductSnapshot"("shopifyProductId");

-- CreateIndex
CREATE INDEX "Asset3D_productSnapshotId_idx" ON "Asset3D"("productSnapshotId");

-- CreateIndex
CREATE INDEX "EngineRun_jobId_idx" ON "EngineRun"("jobId");

-- CreateIndex
CREATE INDEX "EngineRun_externalRunId_idx" ON "EngineRun"("externalRunId");
