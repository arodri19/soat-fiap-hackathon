<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppSnackbar from '@/components/AppSnackbar.vue';
import AppLayout from '@/layouts/AppLayout.vue';

const route = useRoute();
const authenticatedArea = computed(() => !!route.meta.requiresAuth);
</script>

<template>
  <v-app>
    <AppLayout v-if="authenticatedArea">
      <router-view />
    </AppLayout>
    <v-main v-else class="auth-bg">
      <router-view />
    </v-main>
    <AppSnackbar />
  </v-app>
</template>

<style>
.auth-bg {
  background:
    radial-gradient(circle at 15% 20%, rgba(237, 20, 91, 0.12), transparent 40%),
    rgb(var(--v-theme-background));
}
</style>
