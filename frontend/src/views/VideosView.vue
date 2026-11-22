<script setup lang="ts">
import { computed, onMounted } from 'vue';
import StatusCards from '@/components/StatusCards.vue';
import UploadCard from '@/components/UploadCard.vue';
import VideosTable from '@/components/VideosTable.vue';
import { usePolling } from '@/composables/usePolling';
import { config } from '@/config';
import { useVideosStore } from '@/stores/videos';

const videos = useVideosStore();

onMounted(() => videos.fetch());

// Atualiza sozinho enquanto houver vídeo na fila ou processando
const hasActive = computed(() => videos.activeCount > 0);
usePolling(() => videos.fetch({ silent: true }), config.pollIntervalMs, hasActive);

function onOptions({ page, itemsPerPage }: { page: number; itemsPerPage: number }) {
  if (page !== videos.page || itemsPerPage !== videos.pageSize)
    void videos.setPage(page, itemsPerPage);
}
</script>

<template>
  <div class="d-flex flex-column ga-6">
    <UploadCard :max-mb="config.maxUploadMb" @uploaded="videos.fetch({ silent: true })" />

    <v-card class="pa-5">
      <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-4">
        <h2 class="text-h6 font-weight-bold">Meus vídeos</h2>
        <div class="d-flex align-center ga-2 text-caption text-medium-emphasis">
          <template v-if="hasActive">
            <v-progress-circular indeterminate size="14" width="2" color="primary" />
            Atualizando automaticamente
          </template>
          <v-btn
            icon="mdi-refresh"
            size="small"
            variant="text"
            aria-label="Atualizar"
            :loading="videos.loading"
            @click="videos.fetch()"
          />
        </div>
      </div>

      <StatusCards
        :counts="videos.counts"
        :total="videos.totalAll"
        :selected="videos.status"
        class="mb-4"
        @select="videos.setFilter"
      />

      <v-alert v-if="videos.error" type="error" variant="tonal" class="mb-4">{{
        videos.error
      }}</v-alert>

      <VideosTable
        :items="videos.items"
        :total="videos.total"
        :page="videos.page"
        :page-size="videos.pageSize"
        :loading="videos.loading"
        @update:options="onOptions"
        @download="videos.download"
      />
    </v-card>
  </div>
</template>
