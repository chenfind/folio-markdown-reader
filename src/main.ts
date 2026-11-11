import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initializePlatform } from './platform'

initializePlatform().then(() => createApp(App).mount('#app')).catch(error => {
  const root = document.querySelector('#app')
  if (root) root.textContent = error instanceof Error ? error.message : '无法初始化应用。'
})
