<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>();
</script>

<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <v-card width="100%" max-width="440" class="pa-6 pa-sm-8" elevation="2">
      <div class="d-flex align-center ga-3 mb-6">
        <v-avatar color="primary" rounded="lg" size="44"
          ><strong class="text-h6">X</strong></v-avatar
        >
        <div>
          <div class="text-h6 font-weight-bold">FIAP X</div>
          <div class="text-body-2 text-medium-emphasis">Processador de vídeos</div>
        </div>
      </div>
      <h1 class="text-h5 font-weight-bold mb-1">{{ title }}</h1>
      <p class="text-body-2 text-medium-emphasis mb-6">{{ subtitle }}</p>
      <slot />
    </v-card>
  </v-container>
</template>
