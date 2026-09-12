/**
 * Zalo-Flow Internationalization (i18n) Engine — Zero Dependency
 * Supports: Vietnamese (vi) & English (en)
 * Features: Variable Interpolation, In-Place DOM Walk, Relative Time Helpers, Zero Form Reset
 */

(function (window) {
  'use strict';

  const DICTIONARY = {
    vi: {
      common: {
        close: 'Đóng',
        cancel: 'Hủy',
        save: 'Lưu',
        save_changes: 'Lưu Thay Đổi',
        delete: 'Xóa',
        confirm: 'Xác Nhận',
        loading: 'Đang tải...',
        success: 'Thành công',
        error: 'Lỗi',
        warning: 'Cảnh báo',
        all: 'Tất cả',
        copy: 'Sao chép',
        copied: 'Đã sao chép!',
        edit: 'Sửa',
        search: 'Tìm kiếm',
        add: 'Thêm',
        actions: 'Tác vụ'
      },
      header: {
        brand_badge: 'LOCAL-FIRST',
        connected: 'Đã Kết Nối (Online)',
        connecting: 'Đang Kết Nối...',
        disconnected: 'Chưa Đăng Nhập',
        need_scan: 'Cần Quét Mã QR',
        reconnect_title: 'Mất kết nối thời gian thực. Đang tự động kết nối lại...',
        account_pill_title: 'Bấm để xem thông tin / Đăng nhập / Đổi tài khoản Zalo',
        ram_title: 'Mức tiêu thụ RAM thực tế / Ngưỡng an toàn (150MB)',
        version_title: 'Phiên bản Zalo-Flow. Bấm để kiểm tra & cập nhật',
        new_version_badge: '⬆️ Bản Mới',
        sync_all_btn: '🔄 Đồng Bộ Lịch Sử',
        sync_all_title: 'Đồng bộ toàn bộ danh bạ và tin nhắn lịch sử Zalo',
        theme_toggle_title_dark: 'Bấm để chuyển sang Giao diện Sáng (Chuẩn Zalo PC)',
        theme_toggle_title_light: 'Bấm để chuyển sang Giao diện Tối (Dark Mode)',
        theme_label_dark: 'Giao diện Tối',
        theme_label_light: 'Giao diện Sáng',
        lang_toggle_title: 'Chuyển đổi ngôn ngữ / Switch Language (VI / EN)',
        donate_btn: 'Ủng Hộ',
        donate_title: 'Ủng hộ phát triển Zalo-Flow'
      },
      rail: {
        chat_tooltip: '💬 Hội Thoại',
        tags_tooltip: '🏷️ Thẻ Phân Loại',
        quick_msg_tooltip: '⚡ Tin Nhắn Nhanh',
        campaigns_tooltip: '📢 Chiến Dịch Remarketing',
        ai_tooltip: '🧠 Trung Tâm AI (5 Tabs)',
        backup_tooltip: '💾 Sao Lưu & Phục Hồi'
      },
      sidebar: {
        search_placeholder: 'Tìm theo tên hoặc ID...',
        phone_lookup_btn: 'Tra SĐT',
        phone_lookup_title: 'Tra cứu Profile Zalo qua Số Điện Thoại',
        filter_all: 'Tất cả',
        filter_unread: 'Chưa đọc',
        filter_personal: 'Cá nhân',
        filter_group: 'Nhóm',
        tag_filter_label: '📌 Lọc theo Thẻ:',
        tag_filter_all: 'Tất cả Thẻ',
        sync_banner_title: 'Đang đồng bộ dữ liệu Zalo...',
        sync_banner_desc: 'Đang nạp danh bạ & nhóm. Bạn có thể xem tin cũ bình thường.',
        empty_conversations: 'Không tìm thấy cuộc trò chuyện nào phù hợp'
      },
      chat: {
        empty_title: 'Chọn khách hàng để xem lịch sử',
        empty_desc: 'Mọi tin nhắn của Khách hàng, Bot AI tự động và Admin can thiệp sẽ xuất hiện tại đây theo thời gian thực.',
        back_btn: '← Quay lại',
        bot_ai_on: '⚡ Bot AI: BẬT',
        bot_ai_off: '⚡ Bot AI: TẮT',
        bot_ai_toggle_title: 'Bật/Tắt Bot AI tự động trả lời cho cuộc trò chuyện này',
        info_btn: '📑 Thông tin',
        info_btn_title: 'Mở thông tin và ghi chú CRM khách hàng',
        more_btn_title: 'Tác vụ khác',
        more_assign_tag: '🏷️ Gắn thẻ phân loại',
        more_set_exemplar: '⭐ Đặt làm mẫu AI',
        more_fetch_history: '📥 Kéo thêm lịch sử',
        unfriended_title: 'Lưu ý:',
        unfriended_desc: 'Người này chưa có trong danh bạ bạn bè của tài khoản Zalo hiện tại. Nếu chưa từng kết bạn hoặc chưa mở nhận tin người lạ, Zalo có thể từ chối gửi tin.',
        pin_sched_title: 'Hẹn gửi:',
        pin_btn_resume: 'Tiếp tục',
        pin_btn_sendnow: 'Gửi ngay',
        pin_btn_edit: 'Sửa',
        pin_btn_cancel: 'Hủy',
        soft_sync_warning: 'Hệ thống đang cập nhật tin nhắn mới nhất từ Zalo... Bạn nên đợi vài giây để tin nhắn hiển thị đầy đủ trước khi trả lời.',
        input_placeholder: 'Nhập tin nhắn... (Gõ / để chọn tin nhanh, Enter để gửi)',
        quick_popover_title: '⚡ Tin nhắn nhanh ({count})',
        quick_popover_manage: 'Quản lý',
        quick_popover_hint: 'Gợi ý: Nhập / vào ô chat để chọn nhanh',
        btn_schedule_title: 'Lên lịch hẹn giờ gửi tin nhắn cho khách hàng này',
        btn_attach_title: 'Gửi hình ảnh hoặc tài liệu đính kèm',
        btn_send_title: 'Gửi tin nhắn (Enter)',
        send_btn_text: 'Gửi',
        recall_btn: 'Thu hồi',
        recall_tooltip: 'Thu hồi tin nhắn này trên cả 2 phía',
        recalled_message: 'Tin nhắn đã được thu hồi',
        date_today: 'Hôm nay',
        date_yesterday: 'Hôm qua'
      },
      modals: {
        zalo_login_title: 'Đăng Nhập & Kết Nối Tài Khoản Zalo',
        zalo_scan_qr_hint: 'Dùng ứng dụng Zalo trên điện thoại quét mã QR bên dưới để kết nối.',
        zalo_switch_account: 'Đổi Tài Khoản Zalo Khác',
        tags_title: 'Quản Lý Thẻ Phân Loại Khách Hàng',
        tags_add_new: 'Thêm Thẻ Mới',
        tags_name_placeholder: 'Nhập tên thẻ (VD: Khách VIP, Chờ cọc...)',
        quick_msg_title: 'Quản Lý Mẫu Tin Nhắn Nhanh',
        quick_msg_add_new: 'Thêm Mẫu Mới',
        quick_msg_cmd_placeholder: 'Phím tắt (VD: /gia, /dc)',
        quick_msg_text_placeholder: 'Nhập nội dung mẫu tin nhắn...',
        campaigns_title: 'Chiến Dịch Remarketing & Chăm Sóc Khách Hàng',
        campaigns_create_btn: 'Tạo Chiến Dịch Mới',
        campaigns_name: 'Tên Chiến Dịch',
        campaigns_status: 'Trạng Thái',
        campaigns_target: 'Đối Tượng Nhận',
        ai_brain_title: 'Trung Tâm AI Studio & Trợ Lý Bán Hàng',
        ai_tab_prompt: 'Nhân Cách & Prompt',
        ai_tab_models: 'Mô Hình & API',
        ai_tab_wiki: 'Kho Tri Thức Wiki',
        ai_tab_settings: 'Cài Đặt Nâng Cao',
        ai_tab_history: 'Nhật Ký Tương Tác',
        backup_title: 'Sao Lưu & Phục Hồi Dữ Liệu',
        backup_export_title: '1. Xuất Dữ Liệu (Backup JSON)',
        backup_export_btn: 'Tải File Backup (.json)',
        backup_copy_btn: 'Sao Chép JSON',
        backup_import_title: '2. Nhập & Hợp Nhất (Import JSON)',
        backup_choose_file_btn: 'Chọn Tệp JSON...',
        backup_start_import_btn: 'Tiến Hành Nạp Dữ Liệu Vào Hệ Thống',
        schedule_title: 'Hẹn Giờ Gửi Tin Nhắn',
        schedule_time_label: 'Thời Gian Gửi:',
        schedule_content_label: 'Nội Dung Tin Nhắn:',
        schedule_save_btn: 'Lên Lịch Gửi',
        phone_lookup_title: 'Tra Cứu Thông Tin Số Điện Thoại Zalo',
        phone_lookup_input_placeholder: 'Nhập số điện thoại (VD: 0912345678)...',
        phone_lookup_submit_btn: 'Tra Cứu Hồ Sơ',
        donate_title: 'Ủng Hộ Phát Triển Zalo-Flow',
        donate_desc: 'Zalo-Flow là dự án mã nguồn mở miễn phí 100%. Mọi sự đồng hành và ủng hộ của bạn đều là nguồn động lực to lớn giúp duy trì và liên tục cập nhật tính năng mới! Cảm ơn bạn rất nhiều! ❤️',
        donate_kofi_sub: 'Buy me a coffee — quốc tế',
        donate_paypal_sub: 'Chuyển qua PayPal.Me',
        donate_momo_sub: 'Quét mã MoMo (Việt Nam)',
        donate_open: 'Mở',
        donate_copy_phone: 'Sao chép SĐT',
        donate_copy_email: 'Sao chép',
        donate_copied_phone: 'Đã sao chép SĐT MoMo vào bộ nhớ tạm!',
        donate_copied_email: 'Đã sao chép Email PayPal vào bộ nhớ tạm!'
      },
      toast: {
        copy_success: 'Đã sao chép vào bộ nhớ tạm!',
        save_success: 'Đã lưu thay đổi thành công!',
        delete_success: 'Đã xóa thành công!',
        sync_started: 'Bắt đầu đồng bộ dữ liệu...',
        sync_completed: 'Đồng bộ hoàn tất: {count} tin nhắn!',
        ai_toggled: 'Trạng thái Bot AI: {status}',
        scan_models_success: 'Quét thành công {count} mô hình AI!',
        backup_exported: 'Đã xuất file sao lưu thành công!',
        backup_imported: 'Đã phục hồi dữ liệu thành công!',
        network_error: 'Lỗi kết nối mạng, vui lòng kiểm tra lại!',
        empty_field: 'Vui lòng điền đầy đủ các thông tin bắt buộc!'
      },
      confirm: {
        delete_tag: 'Bạn có chắc chắn muốn xóa thẻ này? Các hội thoại đang gắn thẻ sẽ bị gỡ bỏ.',
        delete_quick_msg: 'Bạn có chắc chắn muốn xóa mẫu tin nhắn nhanh này?',
        delete_campaign: 'Bạn có chắc chắn muốn xóa chiến dịch này?',
        cancel_schedule: 'Bạn có chắc muốn hủy lịch hẹn gửi tin nhắn này?',
        switch_account: 'Chuyển tài khoản sẽ làm mới phiên đăng nhập Zalo hiện tại. Bạn có chắc muốn tiếp tục?'
      }
    },

    en: {
      common: {
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        save_changes: 'Save Changes',
        delete: 'Delete',
        confirm: 'Confirm',
        loading: 'Loading...',
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        all: 'All',
        copy: 'Copy',
        copied: 'Copied!',
        edit: 'Edit',
        search: 'Search',
        add: 'Add',
        actions: 'Actions'
      },
      header: {
        brand_badge: 'LOCAL-FIRST',
        connected: 'Connected (Online)',
        connecting: 'Connecting...',
        disconnected: 'Disconnected',
        need_scan: 'QR Scan Required',
        reconnect_title: 'Real-time connection lost. Reconnecting automatically...',
        account_pill_title: 'Click to view details / Login / Switch Zalo profile',
        ram_title: 'Live RAM usage / Safety limit (150MB)',
        version_title: 'Zalo-Flow version. Click to check updates',
        new_version_badge: '⬆️ Update Available',
        sync_all_btn: '🔄 Full Sync History',
        sync_all_title: 'Synchronize full contact list and conversation history',
        theme_toggle_title_dark: 'Click to switch to Light Mode (Zalo PC style)',
        theme_toggle_title_light: 'Click to switch to Dark Mode',
        theme_label_dark: 'Dark Mode',
        theme_label_light: 'Light Mode',
        lang_toggle_title: 'Switch Language / Chuyển đổi ngôn ngữ (EN / VI)',
        donate_btn: 'Donate',
        donate_title: 'Support Zalo-Flow development'
      },
      rail: {
        chat_tooltip: '💬 Conversations',
        tags_tooltip: '🏷️ Customer Tags',
        quick_msg_tooltip: '⚡ Quick Messages',
        campaigns_tooltip: '📢 Campaigns & CRM',
        ai_tooltip: '🧠 AI Studio (5 Tabs)',
        backup_tooltip: '💾 Backup & Restore'
      },
      sidebar: {
        search_placeholder: 'Search by name or ID...',
        phone_lookup_btn: 'Find Phone',
        phone_lookup_title: 'Lookup Zalo profile by phone number',
        filter_all: 'All',
        filter_unread: 'Unread',
        filter_personal: 'Direct',
        filter_group: 'Groups',
        tag_filter_label: '📌 Filter by Tag:',
        tag_filter_all: 'All Tags',
        sync_banner_title: 'Syncing Zalo Data...',
        sync_banner_desc: 'Loading contacts & groups. You can browse chat history normally.',
        empty_conversations: 'No matching conversations found'
      },
      chat: {
        empty_title: 'Select a conversation to start',
        empty_desc: 'All customer messages, automated AI responses, and agent interventions will appear here in real-time.',
        back_btn: '← Back',
        bot_ai_on: '⚡ AI Bot: ON',
        bot_ai_off: '⚡ AI Bot: OFF',
        bot_ai_toggle_title: 'Enable or disable AI auto-replies for this conversation',
        info_btn: '📑 Details',
        info_btn_title: 'Open CRM customer details and private notes',
        more_btn_title: 'More actions',
        more_assign_tag: '🏷️ Assign customer tags',
        more_set_exemplar: '⭐ Set as AI exemplar',
        more_fetch_history: '📥 Load more history',
        unfriended_title: 'Notice:',
        unfriended_desc: 'This user is not yet in your contacts. If stranger messaging is disabled on their account, delivery may fail.',
        pin_sched_title: 'Scheduled for:',
        pin_btn_resume: 'Resume',
        pin_btn_sendnow: 'Send Now',
        pin_btn_edit: 'Edit',
        pin_btn_cancel: 'Cancel',
        soft_sync_warning: 'Syncing recent messages from Zalo... Please wait a few seconds before sending a response.',
        input_placeholder: 'Type a message... (Type / for quick messages, Enter to send)',
        quick_popover_title: '⚡ Quick Messages ({count})',
        quick_popover_manage: 'Manage',
        quick_popover_hint: 'Tip: Type / in the chat box to pick shortcuts',
        btn_schedule_title: 'Schedule a message for this customer',
        btn_attach_title: 'Attach image or file',
        btn_send_title: 'Send message (Enter)',
        send_btn_text: 'Send',
        recall_btn: 'Recall',
        recall_tooltip: 'Recall this message for both participants',
        recalled_message: 'Message was recalled',
        date_today: 'Today',
        date_yesterday: 'Yesterday'
      },
      modals: {
        zalo_login_title: 'Zalo Account Login & Connection',
        zalo_scan_qr_hint: 'Scan the QR code below using your mobile Zalo app to authenticate.',
        zalo_switch_account: 'Switch to Another Zalo Account',
        tags_title: 'Customer Tags Management',
        tags_add_new: 'Add New Tag',
        tags_name_placeholder: 'Enter tag name (e.g. VIP Customer, Pending...)',
        quick_msg_title: 'Quick Message Templates',
        quick_msg_add_new: 'Add New Template',
        quick_msg_cmd_placeholder: 'Shortcut (e.g. /pricing, /address)',
        quick_msg_text_placeholder: 'Enter quick message template content...',
        campaigns_title: 'Remarketing Campaigns & Outreach',
        campaigns_create_btn: 'Create New Campaign',
        campaigns_name: 'Campaign Name',
        campaigns_status: 'Status',
        campaigns_target: 'Target Audience',
        ai_brain_title: 'AI Studio & Sales Copilot',
        ai_tab_prompt: 'Persona & System Prompt',
        ai_tab_models: 'Models & API Providers',
        ai_tab_wiki: 'Wiki Knowledge Base',
        ai_tab_settings: 'Engine Settings',
        ai_tab_history: 'Interaction Logs',
        backup_title: 'Backup & Restore Data',
        backup_export_title: '1. Export Data (Backup JSON)',
        backup_export_btn: 'Download Backup File (.json)',
        backup_copy_btn: 'Copy Raw JSON',
        backup_import_title: '2. Import & Merge (JSON)',
        backup_choose_file_btn: 'Choose JSON File...',
        backup_start_import_btn: 'Proceed with Data Ingestion',
        schedule_title: 'Schedule Message Dispatch',
        schedule_time_label: 'Dispatch Time:',
        schedule_content_label: 'Message Content:',
        schedule_save_btn: 'Save Schedule',
        phone_lookup_title: 'Lookup Zalo Profile by Phone',
        phone_lookup_input_placeholder: 'Enter phone number (e.g. 0912345678)...',
        phone_lookup_submit_btn: 'Lookup Profile',
        donate_title: 'Support Zalo-Flow Development',
        donate_desc: 'Zalo-Flow is 100% free and open-source. Every contribution keeps the project alive, well-maintained, and growing with new features. Thank you so much! ❤️',
        donate_kofi_sub: 'Buy me a coffee — international friendly',
        donate_paypal_sub: 'Direct transfer via PayPal.Me',
        donate_momo_sub: 'Scan QR with MoMo app (Vietnam)',
        donate_open: 'Open',
        donate_copy_phone: 'Copy Phone',
        donate_copy_email: 'Copy',
        donate_copied_phone: 'Copied MoMo phone number to clipboard!',
        donate_copied_email: 'Copied PayPal email to clipboard!'
      },
      toast: {
        copy_success: 'Copied to clipboard!',
        save_success: 'Changes saved successfully!',
        delete_success: 'Deleted successfully!',
        sync_started: 'Starting history synchronization...',
        sync_completed: 'Sync completed: {count} messages!',
        ai_toggled: 'AI Bot status: {status}',
        scan_models_success: 'Successfully discovered {count} AI models!',
        backup_exported: 'Backup file exported successfully!',
        backup_imported: 'Data imported and merged successfully!',
        network_error: 'Network error, please verify your connection!',
        empty_field: 'Please fill in all required fields!'
      },
      confirm: {
        delete_tag: 'Are you sure you want to delete this tag? All assigned conversations will be untagged.',
        delete_quick_msg: 'Are you sure you want to delete this quick message template?',
        delete_campaign: 'Are you sure you want to delete this campaign?',
        cancel_schedule: 'Are you sure you want to cancel this scheduled message?',
        switch_account: 'Switching accounts will terminate the current Zalo session. Proceed?'
      }
    }
  };

  /**
   * Safe Language Getter
   */
  function getLanguage() {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const urlLang = new URLSearchParams(window.location.search).get('lang');
        if (urlLang === 'en' || urlLang === 'vi') return urlLang;
      }
      const saved = localStorage.getItem('zaloflow_lang');
      if (saved === 'en' || saved === 'vi') return saved;
      // Auto-detect browser language if not set
      const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
      return browserLang.startsWith('vi') ? 'vi' : 'en';
    } catch (e) {
      return 'vi';
    }
  }

  /**
   * Main Translation Function with Variable Interpolation
   * Usage:
   *   t('common.save')
   *   t('toast.sync_completed', { count: 42 })
   *   t('unknown.key', 'Fallback Text')
   */
  function t(key, params, fallback) {
    if (typeof params === 'string') {
      fallback = params;
      params = null;
    }
    const lang = getLanguage();
    const keys = (key || '').split('.');
    let val = DICTIONARY[lang];

    for (let i = 0; i < keys.length; i++) {
      val = val ? val[keys[i]] : undefined;
    }

    // Fallback to Vietnamese if English key is missing
    if (val === undefined && lang !== 'vi') {
      let viVal = DICTIONARY.vi;
      for (let i = 0; i < keys.length; i++) {
        viVal = viVal ? viVal[keys[i]] : undefined;
      }
      val = viVal;
    }

    let res = val !== undefined ? val : (fallback || key);

    if (params && typeof res === 'string') {
      res = res.replace(/\{(\w+)\}/g, function (match, paramKey) {
        return params[paramKey] !== undefined ? params[paramKey] : match;
      });
    }

    return res;
  }

  /**
   * In-Place DOM Walk & Translation (Zero Form Data Loss)
   */
  function applyLanguageToDOM() {
    const lang = getLanguage();
    document.documentElement.setAttribute('lang', lang);

    // 1. Text content
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key, el.textContent);
      }
    });

    // 2. Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.placeholder = t(key, el.placeholder);
      }
    });

    // 3. Titles (Tooltips)
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.title = t(key, el.title);
      }
    });

    // 4. Data-tooltip (Nav Rail)
    document.querySelectorAll('[data-i18n-tooltip]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-tooltip');
      if (key) {
        el.setAttribute('data-tooltip', t(key, el.getAttribute('data-tooltip')));
      }
    });

    // 5. Update Language Switcher Button on Header
    const langBtn = document.getElementById('lang-toggle-btn');
    const langIcon = document.getElementById('lang-icon');
    const langText = document.getElementById('lang-text');
    if (langBtn) {
      langBtn.title = t('header.lang_toggle_title');
    }
    if (langIcon && langText) {
      if (lang === 'en') {
        langIcon.textContent = '🇬🇧';
        langText.textContent = 'EN';
      } else {
        langIcon.textContent = '🇻🇳';
        langText.textContent = 'VI';
      }
    }
  }

  /**
   * Set and persist language
   */
  function setLanguage(lang, save = true) {
    if (lang !== 'vi' && lang !== 'en') lang = 'vi';
    if (save) {
      try {
        localStorage.setItem('zaloflow_lang', lang);
      } catch (e) {}
    }
    applyLanguageToDOM();
    window.dispatchEvent(new CustomEvent('zaloflow:langchange', { detail: { lang } }));
  }

  /**
   * Toggle between VI and EN
   */
  function toggleLanguage() {
    const current = getLanguage();
    const next = current === 'en' ? 'vi' : 'en';
    setLanguage(next, true);
    return next;
  }

  /**
   * Date & Relative Time Internationalization Helpers
   */
  function i18nFormatDate(date, options) {
    const lang = getLanguage();
    const locale = lang === 'en' ? 'en-US' : 'vi-VN';
    const d = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat(locale, options || {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  }

  function i18nGetRelativeTime(diffMinutes) {
    const lang = getLanguage();
    if (diffMinutes <= 0) {
      return lang === 'en' ? 'sending now...' : 'đang gửi...';
    }
    if (diffMinutes < 60) {
      return lang === 'en' ? `in ${diffMinutes}m` : `còn ${diffMinutes}p`;
    }
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    if (hours < 24) {
      return lang === 'en' ? `in ${hours}h ${mins}m` : `còn ${hours}h ${mins}p`;
    }
    const days = Math.floor(hours / 24);
    return lang === 'en' ? `in ${days} days` : `sau ${days} ngày`;
  }

  // Export to window
  window.i18n = {
    DICTIONARY,
    t,
    getLanguage,
    setLanguage,
    toggleLanguage,
    applyLanguageToDOM,
    formatDate: i18nFormatDate,
    getRelativeTime: i18nGetRelativeTime
  };
  window.t = t;
  window.toggleAppLanguage = toggleLanguage;

  // Auto-bind on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLanguageToDOM);
  } else {
    applyLanguageToDOM();
  }

})(window);
