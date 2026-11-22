<script setup lang="ts">
import { computed } from 'vue';
import type { VideoStatus } from '@/api/types';
import { STATUS_INFO } from '@/utils/status';

const props = defineProps<{ status: VideoStatus }>();
const info = computed(() => STATUS_INFO[props.status]);
</script>

<template>
  <v-chip :color="info.color" size="small" variant="tonal" label class="font-weight-medium">
    <v-progress-circular
      v-if="status === 'PROCESSING'"
      indeterminate
      size="12"
      width="2"
      class="mr-2"
    />
    <v-icon v-else :icon="info.icon" start size="16" />
    {{ info.label }}
  </v-chip>
</template>
