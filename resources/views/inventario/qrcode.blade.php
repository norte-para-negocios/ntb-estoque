<div class="modal fade" id="qrcodeModal" tabindex="-1" aria-labelledby="qrcodeModalLabel" aria-hidden="true"
     style="background-color: rgba(0, 0, 0, .8);"
>
    <div class="modal-dialog modal-dialog-centered border-0 rounded-0"
    >
        <div class="modal-content border-0 rounded-0 m-1"
             style="background-color: #000000 !important; min-height: 40vh;">

            <div class="modal-header d-flex justify-content-end align-items-center border-0 rounded-0">
                <button type="button" class="btn" data-bs-dismiss="modal" aria-label="Close">
                    <img src="{{asset('images/fechar.png')}}" alt="Fechar">
                </button>
            </div>

            <div class="modal-body d-flex justify-content-center align-items-center" style="height:320px;">
                <!-- Moldura do scanner -->
                <div class="scanner-wrapper">
                    <div id="reader"></div>
                    <div class="scanner-frame">
                        <span class="corner tl"></span>
                        <span class="corner tr"></span>
                        <span class="corner bl"></span>
                        <span class="corner br"></span>
                    </div>
                </div>
            </div>

            <div class="modal-footer border-0 rounded-0" style="background-color: #000000 !important; min-height: 60px;">

            </div>
        </div>
    </div>
</div>
@push('css')
    <style>
        .scanner-wrapper {
            position: relative;
            width: 300px;
            height: 300px;
        }

        #reader {
            width: 100%;
            height: 100%;
        }

        .scanner-frame {
            position: absolute;
            top: 0; left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none; /* não atrapalha o clique */
        }

        .scanner-frame .corner {
            position: absolute;
            width: 40px;
            height: 40px;
            border: 3px solid #fff;
        }

        .corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
        .corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
        .corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
        .corner.br { bottom: 0; right: 0; border-left: none; border-top: none; }
    </style>

@endpush
