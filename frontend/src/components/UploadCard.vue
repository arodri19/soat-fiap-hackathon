<script setup lang="ts">
import { ref } from 'vue';
import { useUploadQueue } from '@/composables/useUploadQueue';
import { ALLOWED_EXTENSIONS, formatBytes } from '@/utils/validation';

const props = defineProps<{ maxMb: number }>();
const emit = defineEmits<{ uploaded: [] }>();

const { items, add, clearFinished } = useUploadQueue({
  maxMb: props.maxMb,
  onUploaded: () => emit('uploaded'),
});
const input = ref<HTMLInputElement>();
const dragging = ref(false);

function onFiles(files: FileList | null | undefined) {
  if (files?.length) void add(files);
  if (input.value) input.value.value = '';
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  onFiles(e.dataTransfer?.files);
}

const accept = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');
</script>

<template>
  <v-card class="pa-5">
    <div class="d-flex align-center justify-space-between mb-1">
      <h2 class="text-h6 font-weight-bold">Enviar vídeos</h2>
      <v-btn
        v-if="items.some((i) => i.state !== 'uploading')"
        size="small"
        variant="text"
        @click="clearFinished"
      >
        Limpar concluídos
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Envie um ou vários vídeos. Cada um entra na fila e é processado em paralelo pelos workers.
    </p>

    <div
      class="dropzone d-flex flex-column align-center justify-center text-center pa-8"
      :class="{ dragging }"
      role="button"
      tabindex="0"
      data-test="dropzone"
      @click="input?.click()"
      @keydown.enter.space.prevent="input?.click()"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <v-icon icon="mdi-cloud-upload-outline" size="40" color="primary" class="mb-2" />
      <div class="text-body-1">
        <strong>Arraste os vídeos aqui</strong> ou clique para selecionar
      </div>
      <div class="text-caption text-medium-emphasis mt-1">
        {{ ALLOWED_EXTENSIONS.join(', ') }} · até {{ maxMb }} MB cada
      </div>
      <input
        ref="input"
        type="file"
        multiple
        :accept="accept"
        hidden
        data-test="file-input"
        @change="onFiles(($event.target as HTMLInputElement).files)"
      />
    </div>

    <v-list v-if="items.length" density="compact" class="mt-3 pa-0">
      <v-list-item v-for="item in items" :key="item.id" class="px-0">
        <template #prepend>
          <v-icon
            :icon="
              item.state === 'done'
                ? 'mdi-check-circle'
                : item.state === 'error'
                  ? 'mdi-alert-circle'
                  : 'mdi-upload'
            "
            :color="
              item.state === 'done' ? 'success' : item.state === 'error' ? 'error' : 'primary'
            "
          />
        </template>
        <v-list-item-title class="text-body-2">{{ item.name }}</v-list-item-title>
        <v-list-item-subtitle>
          <span v-if="item.state === 'error'" class="text-error">{{ item.error }}</span>
          <span v-else-if="item.state === 'done'"
            >Na fila de processamento · {{ formatBytes(item.size) }}</span
          >
          <span v-else>Enviando… {{ item.progress }}%</span>
        </v-list-item-subtitle>
        <v-progress-linear
          v-if="item.state === 'uploading'"
          :model-value="item.progress"
          color="primary"
          height="4"
          rounded
          class="mt-1"
        />
      </v-list-item>
    </v-list>
  </v-card>
</template>

<style scoped>
.dropzone {
  border: 2px dashed rgba(var(--v-border-color), 0.35);
  border-radius: 12px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.dropzone:hover,
.dropzone:focus-visible,
.dropzone.dragging {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
  outline: none;
}
</style>
