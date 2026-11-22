<script setup lang="ts">
import type { StatusCounts, VideoStatus } from '@/api/types';
import { STATUS_INFO } from '@/utils/status';

defineProps<{ counts: StatusCounts; total: number; selected: VideoStatus | null }>();
const emit = defineEmits<{ select: [status: VideoStatus | null] }>();

const statuses: VideoStatus[] = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'];
</script>

<template>
  <v-row dense>
    <v-col cols="6" sm="4" md="">
      <v-card
        :variant="selected === null ? 'tonal' : 'flat'"
        border
        :color="selected === null ? 'primary' : undefined"
        class="pa-4"
        data-test="status-ALL"
        @click="emit('select', null)"
      >
        <div class="text-h5 font-weight-bold">{{ total }}</div>
        <div class="text-caption text-medium-emphasis">Todos</div>
      </v-card>
    </v-col>
    <v-col v-for="s in statuses" :key="s" cols="6" sm="4" md="">
      <v-card
        :variant="selected === s ? 'tonal' : 'flat'"
        border
        :color="selected === s ? STATUS_INFO[s].color : undefined"
        class="pa-4"
        :data-test="`status-${s}`"
        @click="emit('select', selected === s ? null : s)"
      >
        <div class="d-flex align-center justify-space-between">
          <span class="text-h5 font-weight-bold" :class="`text-${STATUS_INFO[s].color}`">
            {{ counts[s] }}
          </span>
          <v-icon :icon="STATUS_INFO[s].icon" :color="STATUS_INFO[s].color" />
        </div>
        <div class="text-caption text-medium-emphasis">{{ STATUS_INFO[s].label }}</div>
      </v-card>
    </v-col>
  </v-row>
</template>
