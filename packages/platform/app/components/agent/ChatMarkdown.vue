<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>

<template>
  <MDC
    :value="content"
    tag="div"
    class="chat-markdown text-sm text-toned"
    :parser-options="{
      highlight: false,
      toc: false,
      contentHeading: false
    }"
  />
</template>

<style scoped>
.chat-markdown {
  overflow-wrap: anywhere;
}

.chat-markdown :deep(p) {
  margin: 0;
  white-space: pre-wrap;
}

.chat-markdown :deep(p + p),
.chat-markdown :deep(p + ul),
.chat-markdown :deep(p + ol),
.chat-markdown :deep(p + pre),
.chat-markdown :deep(p + blockquote),
.chat-markdown :deep(ul + p),
.chat-markdown :deep(ol + p),
.chat-markdown :deep(pre + p),
.chat-markdown :deep(blockquote + p),
.chat-markdown :deep(ul + ul),
.chat-markdown :deep(ol + ol),
.chat-markdown :deep(ul + ol),
.chat-markdown :deep(ol + ul),
.chat-markdown :deep(blockquote + ul),
.chat-markdown :deep(blockquote + ol),
.chat-markdown :deep(pre + ul),
.chat-markdown :deep(pre + ol) {
  margin-top: 0.75rem;
}

.chat-markdown :deep(ul),
.chat-markdown :deep(ol) {
  margin: 0;
  padding-inline-start: 1.25rem;
}

.chat-markdown :deep(ul) {
  list-style: disc;
}

.chat-markdown :deep(ol) {
  list-style: decimal;
}

.chat-markdown :deep(li) {
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
}

.chat-markdown :deep(li > p) {
  display: inline;
}

.chat-markdown :deep(blockquote) {
  margin: 0;
  border-inline-start: 3px solid rgb(34 197 94 / 0.3);
  padding-inline-start: 0.875rem;
  color: rgb(115 115 115);
}

.dark .chat-markdown :deep(blockquote) {
  color: rgb(161 161 170);
}

.chat-markdown :deep(a) {
  color: rgb(22 101 52);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dark .chat-markdown :deep(a) {
  color: rgb(74 222 128);
}

.chat-markdown :deep(code) {
  border-radius: 0.375rem;
  background: rgb(0 0 0 / 0.06);
  padding: 0.125rem 0.375rem;
  font-size: 0.875em;
}

.dark .chat-markdown :deep(code) {
  background: rgb(255 255 255 / 0.08);
}

.chat-markdown :deep(pre) {
  margin: 0;
  overflow-x: auto;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.75rem;
  background: rgb(0 0 0 / 0.04);
  padding: 0.875rem 1rem;
}

.dark .chat-markdown :deep(pre) {
  border-color: rgb(255 255 255 / 0.1);
  background: rgb(255 255 255 / 0.04);
}

.chat-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 0.875rem;
}

.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3),
.chat-markdown :deep(h4),
.chat-markdown :deep(h5),
.chat-markdown :deep(h6) {
  margin: 0;
  color: inherit;
  font-weight: 600;
  line-height: 1.35;
}

.chat-markdown :deep(h1 + p),
.chat-markdown :deep(h2 + p),
.chat-markdown :deep(h3 + p),
.chat-markdown :deep(h4 + p),
.chat-markdown :deep(h5 + p),
.chat-markdown :deep(h6 + p),
.chat-markdown :deep(h1 + ul),
.chat-markdown :deep(h2 + ul),
.chat-markdown :deep(h3 + ul),
.chat-markdown :deep(h4 + ul),
.chat-markdown :deep(h5 + ul),
.chat-markdown :deep(h6 + ul),
.chat-markdown :deep(h1 + ol),
.chat-markdown :deep(h2 + ol),
.chat-markdown :deep(h3 + ol),
.chat-markdown :deep(h4 + ol),
.chat-markdown :deep(h5 + ol),
.chat-markdown :deep(h6 + ol) {
  margin-top: 0.5rem;
}

.chat-markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  border: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}

.dark .chat-markdown :deep(th),
.dark .chat-markdown :deep(td) {
  border-color: rgb(255 255 255 / 0.1);
}
</style>
