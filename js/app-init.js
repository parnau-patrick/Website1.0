
document.addEventListener('DOMContentLoaded', function() {
  
  const btnNewReservation = document.getElementById('btnNewReservation');
  if (btnNewReservation) {
    btnNewReservation.addEventListener('click', function() {
      window.location.reload();
    });
  }
  
  
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('close-btn')) {
      e.target.parentElement.remove();
    }
  });
});