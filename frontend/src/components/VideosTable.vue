<script setup lang="ts">
import type { Video } from '@/api/types';
import StatusChip from '@/components/StatusChip.vue';
import { formatBytes, formatDateTime } from '@/utils/validation';

defineProps<{
  items: Video[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
}>();
const emit = defineEmits<{
  'update:options': [opts: { page: number; itemsPerPage: number }];
  download: [video: Video];
}>();

const headers = [
  { title: 'Vídeo', key: 'original_filename', sortable: false },
  { title: 'Status', key: 'status', sortable: false },
  { title: 'Frames', key: 'frame_count', sortable: false, align: 'end' as const },
  { title: 'Tamanho', key: 'size_bytes', sortable: false, align: 'end' as const },
  { title: 'Enviado em', key: 'created_at', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :items-per-page="pageSize"
    :items-per-page-options="[5, 10, 20, 50]"
    :loading="loading"
    item-value="id"
    no-data-text="Nenhum vídeo por aqui ainda. Envie o primeiro acima."
    loading-text="Carregando…"
    @update:options="(o: { page: number; itemsPerPage: number }) => emit('update:options', o)"
  >
    <template #item.original_filename="{ item }">
      <div
        class="font-weight-medium text-truncate"
        style="max-width: 280px"
        :title="item.original_filename"
      >
        {{ item.original_filename }}
      </div>
      <div v-if="item.status === 'FAILED' && item.error_message" class="text-caption text-error">
        {{ item.error_message }}
      </div>
    </template>
    <template #item.status="{ item }">
      <StatusChip :status="item.status" />
    </template>
    <template #item.frame_count="{ item }">{{ item.frame_count ?? '—' }}</template>
    <template #item.size_bytes="{ item }">{{ formatBytes(item.size_bytes) }}</template>
    <template #item.created_at="{ item }">
      <span class="text-no-wrap">{{ formatDateTime(item.created_at) }}</span>
    </template>
    <template #item.actions="{ item }">
      <v-btn
        v-if="item.status === 'DONE'"
        color="primary"
        size="small"
        prepend-icon="mdi-download"
        :data-test="`download-${item.id}`"
        @click="emit('download', item)"
      >
        Baixar zip
      </v-btn>
    </template>
  </v-data-table-server>
</template>
