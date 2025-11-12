/**
 * Sets up Justified Gallery.
 */
if (!!$.prototype.justifiedGallery) {
  var options = {
    rowHeight: 140,
    margins: 4,
    lastRow: "justify"
  };
  $(".article-gallery").justifiedGallery(options);
}

$(document).ready(function() {

  /**
   * Shows the responsive navigation menu on mobile.
   */
  $("#header > #nav > ul > .icon").click(function() {
    $("#header > #nav > ul").toggleClass("responsive");
  });


  /**
   * Controls the different versions of  the menu in blog post articles 
   * for Desktop, tablet and mobile.
   */
  if ($(".post").length) {
    var menu = $("#menu");
    var nav = $("#menu > #nav");
    var menuIcon = $("#menu-icon, #menu-icon-tablet");

    // 菜单相关逻辑 
    if ($(document).width() >= 1440) {
      menu.show();
      menuIcon.addClass("active");
    }
    menuIcon.click(function() {
      if (menu.is(":hidden")) {
        menu.show();
        menuIcon.addClass("active");
      } else {
        menu.hide();
        menuIcon.removeClass("active");
      }
      return false;
    });
    if (menu.length) {
      $(window).on("scroll", function() {
        var topDistance = menu.offset().top;
        if (!nav.is(":visible") && topDistance < 50) {
          nav.show();
        } else if (nav.is(":visible") && topDistance > 100) {
          nav.hide();
        }
        if ( ! $( "#menu-icon" ).is(":visible") && topDistance < 50 ) {
          $("#menu-icon-tablet").show();
          $("#top-icon-tablet").hide();
        } else if (! $( "#menu-icon" ).is(":visible") && topDistance > 100) {
          $("#menu-icon-tablet").hide();
          $("#top-icon-tablet").show();
        }
      });
    }
    if ($( "#footer-post").length) {
      var lastScrollTop = 0;
      $(window).on("scroll", function() {
        var topDistance = $(window).scrollTop();
        if (topDistance > lastScrollTop){
          $("#footer-post").hide();
        } else {
          $("#footer-post").show();
        }
        lastScrollTop = topDistance;
        $("#nav-footer").hide();
        $("#toc-footer").hide();
        $("#share-footer").hide();
        if (topDistance < 50) {
          $("#actions-footer > #top").hide();
        } else if (topDistance > 100) {
          $("#actions-footer > #top").show();
        }
      });
    }
  }

  // -------- 脚注 Tooltip 初始化与动态监听 --------
  function initFootnoteTooltip() {
    $(".footnote-ref a").each(function() {
      var $ref = $(this);
      var href = $ref.attr("href");
      if (!href || href.indexOf('#fn') !== 0) return;
      var $note = $(href);
      if ($note.length) {
        var noteText = $note.text().replace(/↩︎/g, "").trim();
        $ref.addClass("tooltipped tooltipped-s");
        $ref.attr("aria-label", noteText);
        $ref.attr("tabindex", "0"); // 便于移动端聚焦
      }
    });
  }
  initFootnoteTooltip();

  var postContent = document.querySelector('.post');
  if (postContent && window.MutationObserver) {
    var observer = new MutationObserver(function(mutations) {
      var needUpdate = false;
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          needUpdate = true;
        }
      });
      if (needUpdate) {
        initFootnoteTooltip();
      }
    });
    observer.observe(postContent, { childList: true, subtree: true });
  }
});
