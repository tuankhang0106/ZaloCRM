<template>
  <v-app class="auth-shell">
    <v-main>
      <div class="auth-grid">
        <aside class="auth-story">
          <div class="auth-wordmark">Zalo<span>CRM</span></div>
          <div class="auth-story-content">
            <div class="eyebrow">Kết nối tạo nên giá trị</div>
            <h2>Mỗi cuộc trò chuyện.<br>Một cơ hội mới.</h2>
            <p>Một không gian tập trung để kết nối khách hàng, chăm sóc quan hệ và phát triển kinh doanh.</p>
            <div class="auth-benefits">
              <div><v-icon size="18">mdi-message-text-outline</v-icon>Quản lý hội thoại từ nhiều tài khoản Zalo</div>
              <div><v-icon size="18">mdi-account-heart-outline</v-icon>Chăm sóc khách hàng xuyên suốt</div>
              <div><v-icon size="18">mdi-chart-timeline-variant</v-icon>Theo dõi hiệu quả kinh doanh</div>
            </div>
          </div>
          <div class="auth-footer">ZALOCRM · KHÔNG GIAN CHĂM SÓC KHÁCH HÀNG</div>
        </aside>
        <section class="auth-form-pane" aria-label="Đăng nhập và thiết lập tài khoản">
          <div class="auth-form-wrap"><slot /></div>
        </section>
      </div>
    </v-main>
  </v-app>
</template>
