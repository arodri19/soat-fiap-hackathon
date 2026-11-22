<script setup lang="ts">
import { computed } from 'vue';
import { useNotifyStore } from '@/stores/notify';

const notify = useNotifyStore();
const current = computed(() => notify.toasts[0]);
</script>

<template>
  <v-snackbar
    :model-value="!!current"
    :color="current?.color"
    :timeout="4500"
    location="bottom right"
    @update:model-value="(open: boolean) => !open && current && notify.dismiss(current.id)"
  >
    {{ current?.text }}
    <template #actions>
      <v-btn
        variant="text"
        icon="mdi-close"
        aria-label="Fechar"
        @click="current && notify.dismiss(current.id)"
      />
    </template>
  </v-snackbar>
</template>
